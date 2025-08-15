import React from "react";

interface ProgressProps {
  value: number; // Progress value between 0 and 100
  className?: string; // Optional additional CSS classes
}

export const Progress: React.FC<ProgressProps> = ({ value, className = "" }) => {
  // clamp value and determine text color (dark below 50, light at 50 and above)
  const pct = Math.min(Math.max(Number(value) || 0, 0), 100);
  const textColorClass = pct >= 50 ? "text-white" : "text-gray-900";

  return (
    <div
      className={`relative w-full h-5 bg-gray-200 rounded-md overflow-hidden ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div
        className="absolute top-0 left-0 h-full bg-soton-blue transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
      <span className={`absolute inset-0 flex items-center justify-center text-sm font-medium transition-colors duration-300 ${textColorClass}`}>
        {Math.round(pct)}%
      </span>
    </div>
  );
};
