import PatientList from '@/components/patient-list';
import DashboardInsights from '@/components/dashboard-insights';

export default function Home() {
  return (
    <div className="min-h-[85vh] space-y-6">
      <DashboardInsights />
      <PatientList />
    </div>
  );
}
