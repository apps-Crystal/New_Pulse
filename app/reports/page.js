import ReportsPage from '../../components/ReportsPage';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Daily Reports | Crystal Pulse',
  description: 'Download the Crystal Group daily temperature report for any archived day',
};

export default function Page() {
  return <ReportsPage />;
}
