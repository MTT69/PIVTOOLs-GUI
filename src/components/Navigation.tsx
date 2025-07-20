'use client';

import { useState, useEffect } from 'react';
import { Github, HelpCircle, Settings, Menu, X } from 'lucide-react';

export default function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav className={`fixed top-0 w-full z-50 transition-all duration-300 ${
      isScrolled ? 'bg-white/95 backdrop-blur-md shadow-lg' : 'bg-transparent'
    }`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <span className="text-2xl font-bold text-soton-blue">PIVTOOLS</span>
              <span className="text-sm ml-2 text-gray-500">Desktop</span>
            </div>
          </div>
          
          <div className="hidden md:flex items-center space-x-4">
            <a 
              href="#" 
              className="text-gray-600 hover:text-soton-blue px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2"
              onClick={() => {}}
            >
              <Settings size={18} />
              Settings
            </a>
            <a 
              href="https://github.com/MTT69/PIVTOOLS" 
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-soton-blue px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2"
            >
              <Github size={18} />
              GitHub
            </a>
            <a 
              href="#" 
              className="text-gray-600 hover:text-soton-blue px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2"
              onClick={() => {}}
            >
              <HelpCircle size={18} />
              Documentation
            </a>
          </div>

          <div className="md:hidden">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="text-gray-700 hover:text-soton-blue p-2"
            >
              {isOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {isOpen && (
          <div className="md:hidden">
            <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 bg-white rounded-lg shadow-lg">
              <a
                href="#"
                className="text-gray-600 hover:text-soton-blue block px-3 py-2 rounded-md text-base font-medium flex items-center gap-2"
                onClick={() => setIsOpen(false)}
              >
                <Settings size={18} />
                Settings
              </a>
              <a
                href="https://github.com/MTT69/PIVTOOLS"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-600 hover:text-soton-blue block px-3 py-2 rounded-md text-base font-medium flex items-center gap-2"
                onClick={() => setIsOpen(false)}
              >
                <Github size={18} />
                GitHub
              </a>
              <a
                href="#"
                className="text-gray-600 hover:text-soton-blue block px-3 py-2 rounded-md text-base font-medium flex items-center gap-2"
                onClick={() => setIsOpen(false)}
              >
                <HelpCircle size={18} />
                Documentation
              </a>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
