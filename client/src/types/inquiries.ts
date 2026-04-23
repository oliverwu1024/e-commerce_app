export type InquiryStatus = 'OPEN' | 'CLOSED';

type Party = {
  id: string;
  username: string;
  avatarUrl: string | null;
  location?: string | null;
};

export type InquirySummary = {
  id: string;
  status: InquiryStatus;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  listing: {
    id: string;
    title: string;
    price: string;
    status: string;
    images: { id: string; url: string }[];
  };
  buyer: Party;
  seller: Party;
  // Set by the server's list endpoint. The component doesn't have to compare
  // currentUserId to figure out which side it's looking at.
  viewerRole?: 'buyer' | 'seller';
  unreadCount?: number;
};

export type InquiryMessage = {
  id: string;
  content: string;
  createdAt: string;
  readAt: string | null;
  sender: { id: string; username: string; avatarUrl: string | null };
};

export type InquiryListResponse = {
  inquiries: InquirySummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type InquiryDetailResponse = {
  inquiry: InquirySummary;
  messages: InquiryMessage[];
};

export type CreateInquiryResponse = {
  inquiry: InquirySummary;
};
