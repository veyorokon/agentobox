'use client';

interface AgentoStatusProps {
  online: boolean;
}

export function AgentoStatus({ online }: AgentoStatusProps) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-2.5 h-2.5 rounded-full ${
          online ? 'bg-[#a3be8c] animate-pulse' : 'bg-[#65737e]'
        }`}
      />
      <span className={`text-sm font-medium ${online ? 'text-[#a3be8c]' : 'text-[#65737e]'}`}>
        {online ? 'Online' : 'Offline'}
      </span>
    </div>
  );
}
