
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionStatus } from './types';
import { createPcmBlob, decodeFromBase64, decodeAudioData } from './utils/audio-processing';
import Visualizer from './components/Visualizer';

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [userText, setUserText] = useState('');

  const sessionRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const nextStartTimeRef = useRef(0);
  const activeSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const visionIntervalRef = useRef<number | null>(null);

  const initAudio = () => {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    if (!outputCtxRef.current) outputCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    
    if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
    if (outputCtxRef.current?.state === 'suspended') outputCtxRef.current.resume();
  };

  const startVision = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
      }
    } catch (e) { 
      console.error("Erro ao acessar câmera:", e);
      alert("Acesso à câmera negado. O protocolo de visão não estará disponível."); 
    }
  };

  const stopVision = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    if (visionIntervalRef.current) {
      clearInterval(visionIntervalRef.current);
      visionIntervalRef.current = null;
    }
  };

  const startSession = async () => {
    if (!process.env.API_KEY || process.env.API_KEY === "undefined") {
      alert("ERRO CRÍTICO: API_KEY não configurada no ambiente.");
      return;
    }

    try {
      setStatus(ConnectionStatus.CONNECTING);
      initAudio();
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const session = await ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setStatus(ConnectionStatus.CONNECTED);
            
            // Entrada de Áudio (Microfone)
            const source = audioCtxRef.current!.createMediaStreamSource(audioStream);
            const processor = audioCtxRef.current!.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              if (isMuted || !sessionRef.current) return;
              sessionRef.current.sendRealtimeInput({ 
                media: createPcmBlob(e.inputBuffer.getChannelData(0)) 
              });
            };
            source.connect(processor);
            processor.connect(audioCtxRef.current!.destination);

            // Protocolo de Visão (Loop de Câmera)
            if (isCameraActive) {
              visionIntervalRef.current = window.setInterval(() => {
                if (!videoRef.current || !sessionRef.current) return;
                const canvas = canvasRef.current;
                const ctx = canvas.getContext('2d');
                canvas.width = 320;
                canvas.height = 240;
                ctx?.drawImage(videoRef.current, 0, 0, 320, 240);
                
                const data = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
                sessionRef.current.sendRealtimeInput({ 
                  media: { data, mimeType: 'image/jpeg' } 
                });
              }, 1000); // 1 frame por segundo para estabilidade
            }
          },
          onmessage: async (msg: LiveServerMessage) => {
            // Saída de Áudio (IA falando)
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && outputCtxRef.current) {
              const ctx = outputCtxRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decodeFromBase64(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              activeSources.current.add(source);
              source.onended = () => activeSources.current.delete(source);
            }

            // Transcrições e Status
            if (msg.serverContent?.outputTranscription) setTranscription(msg.serverContent.outputTranscription.text);
            if (msg.serverContent?.inputTranscription) setUserText(msg.serverContent.inputTranscription.text);
            
            if (msg.serverContent?.turnComplete) {
              setTimeout(() => { setTranscription(''); setUserText(''); }, 3000);
            }

            // Barge-in (Interrupção quando o usuário fala)
            if (msg.serverContent?.interrupted) {
              activeSources.current.forEach(s => { try { s.stop(); } catch(e){} });
              activeSources.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => {
            console.error("Erro na sessão:", e);
            setStatus(ConnectionStatus.ERROR);
          },
          onclose: () => {
            setStatus(ConnectionStatus.DISCONNECTED);
            if (visionIntervalRef.current) clearInterval(visionIntervalRef.current);
          }
        },
        config: {
          systemInstruction: "Você é o JARVIS, o sistema de IA da Stark Industries. Você é britânico, formal, polido e ocasionalmente sarcástico. Chame o usuário de Senhor ou Senhora. Você tem acesso à câmera e deve usar o que vê para auxiliar o usuário. Responda em Português do Brasil.",
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
          },
          outputAudioTranscription: {},
          inputAudioTranscription: {}
        }
      });
      sessionRef.current = session;
    } catch (err) {
      console.error("Falha ao iniciar JARVIS:", err);
      setStatus(ConnectionStatus.ERROR);
    }
  };

  const stopSession = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    setStatus(ConnectionStatus.DISCONNECTED);
    if (visionIntervalRef.current) {
      clearInterval(visionIntervalRef.current);
      visionIntervalRef.current = null;
    }
  };

  return (
    <div className="relative min-h-screen w-full flex flex-col items-center justify-between p-6 bg-[#020617] overflow-hidden">
      
      {/* HUD HEADER */}
      <header className="w-full flex justify-between items-center z-20 border-b border-cyan-500/10 pb-4">
        <div className="flex flex-col">
          <h1 className="orbitron text-lg font-black text-cyan-400 glow-cyan tracking-tighter">JARVIS <span className="opacity-30">OS</span></h1>
          <span className="text-[8px] orbitron text-cyan-800 tracking-[0.4em] uppercase font-bold">Protocolo_Stark_Ativo</span>
        </div>
        <div className={`px-3 py-1 rounded border transition-colors ${status === ConnectionStatus.CONNECTED ? 'border-green-500/50 bg-green-500/5' : 'border-red-500/50 bg-red-500/5'}`}>
          <span className={`orbitron text-[9px] ${status === ConnectionStatus.CONNECTED ? 'text-green-500' : 'text-red-500 animate-pulse'}`}>
            {status === ConnectionStatus.CONNECTED ? 'SISTEMA_ONLINE' : 'SISTEMA_OFFLINE'}
          </span>
        </div>
      </header>

      {/* ÁREA CENTRAL */}
      <main className="flex-1 flex flex-col items-center justify-center w-full relative">
        
        {/* VISÃO DA CÂMERA */}
        <div className={`absolute top-0 transition-all duration-1000 ${isCameraActive ? 'opacity-100 scale-100' : 'opacity-0 scale-50 pointer-events-none'} w-40 h-40 md:w-56 md:h-56 rounded-full overflow-hidden border border-cyan-500/30 shadow-[0_0_20px_rgba(6,182,212,0.2)] z-0`}>
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover grayscale brightness-110 contrast-125" />
          <div className="absolute inset-0 bg-cyan-900/10 mix-blend-overlay"></div>
        </div>

        {/* NÚCLEO REATIVO */}
        <div className="relative z-10">
          <Visualizer isActive={status === ConnectionStatus.CONNECTED} isSpeaking={transcription.length > 0} />
        </div>

        {/* TRANSCRIÇÃO / FEEDBACK */}
        <div className="mt-8 h-24 flex flex-col items-center justify-center px-4 text-center z-20">
          {userText && <p className="text-cyan-700 orbitron text-[9px] uppercase tracking-widest mb-2 animate-pulse">Capturando Entrada...</p>}
          <p className="text-cyan-100 orbitron text-lg md:text-2xl font-bold leading-tight glow-cyan transition-all duration-300">
            {transcription || (status === ConnectionStatus.CONNECTED ? "AGUARDANDO COMANDO" : "NÚCLEO DESATIVADO")}
          </p>
        </div>
      </main>

      {/* CONTROLES INFERIORES */}
      <footer className="w-full flex flex-col items-center gap-6 pb-12 z-20">
        
        <div className="flex items-center gap-6">
          {/* TOGGLE CÂMERA */}
          <button 
            onClick={isCameraActive ? stopVision : startVision}
            className={`p-4 rounded-full border transition-all ${isCameraActive ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.4)]' : 'bg-slate-900/50 border-white/10 text-white/20'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
              <path d="M10.5 8.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/>
              <path d="M2 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1.172a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 9.172 2H6.828a2 2 0 0 0-1.414.586l-.828.828A2 2 0 0 1 3.172 4H2zm.5 2a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm9 2.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z"/>
            </svg>
          </button>

          {/* BOTÃO PRINCIPAL */}
          <button 
            onClick={status === ConnectionStatus.CONNECTED ? stopSession : startSession}
            disabled={status === ConnectionStatus.CONNECTING}
            className={`relative w-24 h-24 rounded-full border-4 flex items-center justify-center transition-all duration-500 ${status === ConnectionStatus.CONNECTED ? 'border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.4)]' : 'border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.2)]'}`}
          >
            <div className={`w-16 h-16 rounded-full flex items-center justify-center ${status === ConnectionStatus.CONNECTED ? 'bg-red-500 animate-pulse' : 'bg-cyan-500 hover:scale-110 transition-transform'}`}>
              {status === ConnectionStatus.CONNECTED ? (
                <div className="w-6 h-6 bg-white rounded-sm"></div>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" fill="black" viewBox="0 0 16 16">
                  <path d="M10.804 8 5 4.633v6.734L10.804 8zm.792-.696a.802.802 0 0 1 0 1.392l-6.363 3.692C4.713 12.69 4 12.345 4 11.692V4.308c0-.653.713-.998 1.233-.696l6.363 3.692z"/>
                </svg>
              )}
            </div>
          </button>

          {/* TOGGLE MUTE */}
          <button 
            onClick={() => setIsMuted(!isMuted)}
            className={`p-4 rounded-full border transition-all ${isMuted ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-slate-900/50 border-white/10 text-white/20'}`}
          >
            {isMuted ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                <path d="M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06zm7.137 2.096a.5.5 0 0 1 0 .708L12.207 8l1.647 1.646a.5.5 0 0 1-.708.708L11.5 8.707l-1.646 1.647a.5.5 0 0 1-.708-.708L10.793 8 9.146 6.354a.5.5 0 1 1 .708-.708L11.5 7.293l1.646-1.647a.5.5 0 0 1 .708 0z"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                <path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5z"/>
                <path d="M10 8a2 2 0 1 1-4 0V3a2 2 0 1 1 4 0v5zM8 0a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V3a3 3 0 0 0-3-3z"/>
              </svg>
            )}
          </button>
        </div>

        <p className="orbitron text-[8px] text-cyan-800 tracking-[0.5em] uppercase font-bold">Iniciando Sequência de Diálogo</p>
      </footer>

      {/* ELEMENTOS DE HUD DECORATIVOS */}
      <div className="fixed inset-0 pointer-events-none opacity-10">
        <div className="absolute top-10 left-10 w-32 h-32 border-l-2 border-t-2 border-cyan-500"></div>
        <div className="absolute bottom-10 right-10 w-32 h-32 border-r-2 border-b-2 border-cyan-500"></div>
        <div className="absolute top-1/2 left-4 w-1 h-32 bg-cyan-500 -translate-y-1/2"></div>
        <div className="absolute top-1/2 right-4 w-1 h-32 bg-cyan-500 -translate-y-1/2"></div>
      </div>
    </div>
  );
};

export default App;
