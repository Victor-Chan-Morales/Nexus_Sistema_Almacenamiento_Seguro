import { AppShell } from "@/components/app-shell";
import { PlatformConsole } from "@/components/platform-console";

export default function SuperAdminDashboardPage() {
  return <AppShell active="/dashboard/super-admin" superAdmin requireSuperAdmin>
    <PlatformConsole />
  </AppShell>;
}
