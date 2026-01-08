
import React, { useEffect, useState } from 'react';

interface VisualizerProps {
  isActive: boolean;
  isSpeaking: boolean;
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, isSpeaking }) => {
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    let frame: number;
    const animate = () => {
      setRotation(prev => prev + (isActive ? 0.5 : 0.1));
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(frame);
  }, [isActive]);

  const color = isActive ? '#06b6d4' : '#ef4444';

  return (
    <div className="relative flex items-center justify-center w-64 h-64 md:w-80 md:h-80">
      
      {/* Outer Rotating HUD Elements */}
      <div 
        className="absolute inset-0 border-[1px] border-cyan-500/20 rounded-full"
        style={{ transform: `rotate(${rotation}deg)`, borderStyle: 'dashed' }}
      ></div>
      
      <div 
        className="absolute inset-4 border-[2px] border-cyan-500/10 rounded-full"
        style={{ transform: `rotate(-${rotation * 1.5}deg)`, borderDasharray: '20 10' }}
      ></div>

      {/* Main Core Ring */}
      <div className={`absolute inset-8 rounded-full border-2 transition-all duration-500 ${isActive ? 'border-cyan-500/50 shadow-[0_0_30px_rgba(6,182,212,0.3)]' : 'border-red-500/30'}`}>
        <div className="absolute inset-0 border-t-4 border-cyan-500 rounded-full opacity-60 animate-spin"></div>
      </div>

      {/* Center Reactive Core */}
      <div className={`relative z-10 w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center transition-all duration-300 ${isSpeaking ? 'scale-110' : 'scale-100'}`}>
        <div className={`absolute inset-0 rounded-full transition-all duration-500 ${isActive ? 'bg-cyan-500/20 blur-xl' : 'bg-red-500/10 blur-md'}`}></div>
        
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_10px_cyan]">
          <defs>
            <radialGradient id="coreGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={color} stopOpacity="0.8" />
              <stop offset="100%" stopColor={color} stopOpacity="0.1" />
            </radialGradient>
          </defs>

          {/* Core Geometry */}
          <circle cx="50" cy="50" r="40" fill="none" stroke={color} strokeWidth="0.5" strokeDasharray="1 3" />
          <circle cx="50" cy="50" r="30" fill="url(#coreGrad)" className={isSpeaking ? 'animate-pulse' : ''} />
          
          {/* Scanning Lines */}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
            <line 
              key={angle}
              x1="50" y1="50" 
              x2={50 + 35 * Math.cos(angle * Math.PI / 180)} 
              y2={50 + 35 * Math.sin(angle * Math.PI / 180)} 
              stroke={color} 
              strokeWidth="0.5"
              opacity="0.3"
            />
          ))}

          {/* Data Rings */}
          <circle 
            cx="50" cy="50" r="20" 
            fill="none" 
            stroke={color} 
            strokeWidth="2" 
            strokeDasharray={isSpeaking ? "5 2" : "2 5"}
            className="transition-all duration-200"
          />
        </svg>
      </div>

      {/* Decorative Hud Text */}
      <div className="absolute top-0 right-0 orbitron text-[7px] text-cyan-500/40">FR_00{Math.floor(rotation % 100)}</div>
      <div className="absolute bottom-0 left-0 orbitron text-[7px] text-cyan-500/40">CORE_SYNC_88%</div>
    </div>
  );
};

export default Visualizer;
