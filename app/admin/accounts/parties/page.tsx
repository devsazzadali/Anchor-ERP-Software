import { redirect } from 'next/navigation'

// The counterparties list now lives as a tab inside the payables
// page (Accounts → পাওনা-দেনা → মানুষ ও প্রতিষ্ঠান). This route is
// kept so old links and bookmarks land in the right place.
export default function PartiesPage() {
  redirect('/admin/accounts/payables?tab=parties')
}
