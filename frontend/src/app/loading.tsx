import { NexusLogoLoader } from '@/components/ui/NexusLogo';

export default function Loading() {
  return (
    <div className="flex-1 flex items-center justify-center w-full h-full min-h-[60vh] bg-background">
      <NexusLogoLoader size={52} />
    </div>
  );
}
