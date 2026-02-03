'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavProps {
  showProjectNav?: boolean;
  projectName?: string;
  projectId?: string;
}

export function Nav({ showProjectNav, projectName, projectId }: NavProps) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#e59758] rounded-lg flex items-center justify-center">
            <svg
              className="w-5 h-5 text-[#2b303b]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </div>
          <span className="text-xl font-bold text-[#c0c5ce]">AgentBox</span>
        </Link>

        {/* Breadcrumb when inside a project */}
        {showProjectNav && projectName && (
          <>
            <span className="text-[#65737e]">/</span>
            <span className="text-[#c0c5ce] font-medium">{projectName}</span>
          </>
        )}
      </div>

      {/* Project Navigation Tabs */}
      {showProjectNav && projectId && (
        <div className="flex items-center gap-1 bg-[#343d46] rounded-full p-1">
          <Link
            href={`/bento/${projectId}`}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              pathname === `/bento/${projectId}`
                ? 'bg-[#4f5b66] text-[#c0c5ce]'
                : 'text-[#65737e] hover:text-[#c0c5ce]'
            }`}
          >
            Agents
          </Link>
          <Link
            href={`/bento/${projectId}/events`}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              pathname === `/bento/${projectId}/events`
                ? 'bg-[#4f5b66] text-[#c0c5ce]'
                : 'text-[#65737e] hover:text-[#c0c5ce]'
            }`}
          >
            Events
          </Link>
        </div>
      )}
    </nav>
  );
}
