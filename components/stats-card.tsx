'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react'

interface StatsCardProps {
  title: string
  value: string
  subtext: string
  icon: LucideIcon
  sparklineColor?: 'emerald' | 'rose' | 'amber' | 'gold' | 'blue'
  sparklineData?: number[]
  trend?: {
    value: string
    isPositive: boolean
  }
}

export default function StatsCard({
  title,
  value,
  subtext,
  icon: Icon,
  sparklineColor = 'emerald',
  sparklineData = [],
  trend
}: StatsCardProps) {
  
  // Custom Sparkline paths builder
  const buildSparklinePath = (data: number[] = []) => {
    if (!data || data.length === 0) return ''
    const width = 100
    const height = 30
    const max = Math.max(...data)
    const min = Math.min(...data)
    const range = max - min === 0 ? 1 : max - min

    // C49: a single data point divided by (length - 1) = 0 → x = NaN
    // and the whole path silently vanished. A lone point renders as
    // a flat mid-line segment.
    if (data.length === 1) {
      const y = height - ((data[0] - min) / range) * height
      return `M 0,${y} L ${width},${y}`
    }

    const points = data.map((val, idx) => {
      const x = (idx / (data.length - 1)) * width
      const y = height - ((val - min) / range) * height
      return `${x},${y}`
    })

    return `M ${points.join(' L ')}`
  }

  const colorMap = {
    emerald: {
      stroke: '#10b981',
      fill: 'rgba(16, 185, 129, 0.05)',
      glow: 'shadow-emerald-500/5'
    },
    rose: {
      stroke: '#ef4444',
      fill: 'rgba(239, 68, 68, 0.05)',
      glow: 'shadow-rose-500/5'
    },
    amber: {
      stroke: '#f59e0b',
      fill: 'rgba(245, 158, 11, 0.05)',
      glow: 'shadow-amber-500/5'
    },
    gold: {
      stroke: '#1ca34c',
      fill: 'rgba(28,163,76, 0.05)',
      glow: 'shadow-[#1ca34c]/5'
    },
    blue: {
      stroke: '#3b82f6',
      fill: 'rgba(59, 130, 246, 0.05)',
      glow: 'shadow-blue-500/5'
    }
  };
  const colorClasses = colorMap[sparklineColor] ?? colorMap['emerald'];

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className={`glass-panel glass-panel-hover p-5 rounded-3xl relative shadow-lg overflow-hidden flex flex-col justify-between h-[155px] ${colorClasses.glow}`}
    >
      {/* Decorative Corner Ambient Glow */}
      <div 
        className="absolute -top-12 -right-12 w-24 h-24 rounded-full filter blur-2xl pointer-events-none transition-all duration-300"
        style={{ backgroundColor: `${colorClasses.stroke}0a` }}
      />

      {/* Header Info */}
      <div className="flex justify-between items-start">
        <div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">
            {title}
          </span>
          <h3 className="text-2xl font-extrabold tracking-tight text-slate-900 font-serif">{value}</h3>
        </div>

        {/* Floating Glass Icon */}
        <div 
          className="p-2.5 rounded-xl border transition-all duration-300"
          style={{ 
            backgroundColor: `${colorClasses.stroke}0c`, 
            borderColor: `${colorClasses.stroke}20`,
            color: colorClasses.stroke
          }}
        >
          <Icon className="w-4 h-4" />
        </div>
      </div>

      {/* Footer Visual Trends & Micro-Sparkline */}
      <div className="flex justify-between items-end mt-4">
        <div className="space-y-1">
          {trend && (
            <div className="flex items-center gap-1 text-[10px] font-bold">
              {trend.isPositive ? (
                <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5 text-rose-600" />
              )}
              <span className={trend.isPositive ? 'text-emerald-600' : 'text-rose-600'}>
                {trend.value}
              </span>
            </div>
          )}
          <span className="text-[10px] text-slate-500 block">{subtext}</span>
        </div>

        {/* Micro Sparkline SVG */}
        <div className="w-[100px] h-[30px] shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
          <svg className="w-full h-full" viewBox="0 0 100 30">
            <path
              d={buildSparklinePath(sparklineData)}
              fill="none"
              stroke={colorClasses.stroke}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Soft gradient fill under sparkline */}
            <path
              d={`${buildSparklinePath(sparklineData)} L 100,30 L 0,30 Z`}
              fill={colorClasses.fill}
              stroke="none"
            />
          </svg>
        </div>
      </div>
    </motion.div>
  )
}
