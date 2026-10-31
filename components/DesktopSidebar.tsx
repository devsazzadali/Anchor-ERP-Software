import Sidebar, { SidebarProps } from './sidebar';

export default function DesktopSidebar({
  onLogout,
  forcedRole,
}: {
  onLogout?: () => void;
  forcedRole: SidebarProps['forcedRole'];
}) {
  return <Sidebar onLogout={onLogout} forcedRole={forcedRole} />;
}
