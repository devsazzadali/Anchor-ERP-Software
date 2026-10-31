"use client";

import { useState } from 'react';
import { X, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar, { SidebarProps } from './sidebar';

/**
 * Mobile-only wrapper for the Sidebar.
 * On desktop (md+) the sidebar column in SidebarWrapper handles visibility.
 * On mobile a hamburger button toggles a slide-in drawer.
 */
export default function SidebarClient(props: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const toggle = () => setIsOpen((prev) => !prev);

  return (
    <div className="md:hidden">
      {/* Hamburger button */}
      <button
        type="button"
        onClick={toggle}
        className="fixed top-4 left-4 z-50 p-3 rounded-xl bg-white/95 backdrop-blur-md border border-slate-900/10 shadow-[0_2px_12px_rgba(15,18,25,0.15)] hover:bg-slate-50 transition-all md:hidden active:scale-95"
        aria-label={isOpen ? 'Close menu' : 'Open menu'}
      >
        {isOpen ? <X className="w-5 h-5 text-slate-900" /> : <Menu className="w-5 h-5 text-[#8a6d1f]" />}
      </button>

      {/* Slide-in drawer */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-slate-950/50 md:hidden"
            onClick={toggle}
          >
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
              className="absolute top-0 left-0 h-full w-64 bg-white backdrop-blur-2xl text-slate-900 shadow-2xl border-r border-slate-900/5"
              onClick={(e) => e.stopPropagation()}
            >
              <Sidebar
                {...props}
                mobile={true}
                closeMenu={toggle}
              />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
