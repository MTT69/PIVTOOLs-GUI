import React from "react";

interface ProgressProps {
  value: number; // Progress value between 0 and 100
  className?: string; // Optional additional CSS classes
}

export const Progress: React.FC<ProgressProps> = ({ value, className = "" }) => {
  return (
    <div className={`relative w-full h-4 bg-gray-200 rounded overflow-hidden ${className}`}>
      <div
        className="absolute top-0 left-0 h-full bg-soton-blue transition-all duration-300"
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
      />
      <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white">
        {Math.min(Math.max(value, 0), 100)}%
      </span>
    </div>
  );
};
