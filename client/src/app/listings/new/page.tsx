'use client';

import ProtectedRoute from '@/components/ProtectedRoute';
import ListingForm from '@/components/ListingForm';

export default function CreateListingPage() {
  return (
    <ProtectedRoute>
      <ListingForm />
    </ProtectedRoute>
  );
}
