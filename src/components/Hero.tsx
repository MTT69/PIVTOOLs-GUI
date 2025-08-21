'use client';

import { motion } from 'framer-motion';
import { ChevronDown, Play, Download } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function Hero({ onGetStarted }: { onGetStarted?: () => void }) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);
  return (
    <section id="hero" className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-soton-blue via-soton-darkblue to-gray-900 pt-32 md:pt-40">
      {/* Background Pattern */}
      <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center opacity-20"></div>
      
      {/* Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="mb-8"
        >
          <h1 className="text-7xl md:text-9xl font-bold text-white mb-8">
            PIV<span className="text-soton-gold">TOOLS</span>
          </h1>
          <p className="text-2xl md:text-3xl text-gray-200 max-w-4xl mx-auto mb-10 font-medium">
            High-Performance Particle Image Velocimetry Processing
          </p>
          <p className="text-xl md:text-2xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
            Accelerate your PIV analysis with our cluster optimised Python and C wrapped algorithms.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="flex flex-col sm:flex-row gap-4 justify-center mb-12"
        >
          <button onClick={() => {
              if (onGetStarted) onGetStarted();
              else if (typeof window !== 'undefined') {
                try { localStorage.setItem('pivtools_seen_hero', 'true'); } catch {}
                // fallback: no-op
              }
            }}
            className="bg-soton-gold text-soton-darkblue px-8 py-4 rounded-lg font-semibold text-lg hover:bg-yellow-400 transition-colors duration-200 flex items-center gap-2 justify-center">
            <Download size={20} />
            Get Started
          </button>
          <button className="border-2 border-white text-white px-8 py-4 rounded-lg font-semibold text-lg hover:bg-white hover:text-soton-darkblue transition-colors duration-200 flex items-center gap-2 justify-center">
            <Play size={20} />
            Watch Demo
          </button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16"
        >
          <div className="text-center">
            <div className="text-4xl font-bold text-soton-gold mb-2">10x</div>
            <div className="text-gray-300">Faster Processing</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold text-soton-gold mb-2">2D & 3D</div>
            <div className="text-gray-300">PIV Analysis</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold text-soton-gold mb-2">100%</div>
            <div className="text-gray-300">Open Source</div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.9 }}
          className="flex justify-center"
        >
          <a href="#features" className="text-white hover:text-soton-gold transition-colors duration-200">
            <ChevronDown size={32} className="animate-bounce" />
          </a>
        </motion.div>
      </div>

      {/* Floating particles animation */}
      {isClient && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[...Array(100)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-2 h-2 bg-soton-gold rounded-full opacity-60"
              animate={{
                y: [0, -100, 0],
                x: [0, Math.random() * 100 - 50, 0],
                opacity: [0.6, 0.2, 0.6],
              }}
              transition={{
                duration: 3 + Math.random() * 2,
                repeat: Infinity,
                delay: Math.random() * 5,
              }}
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
