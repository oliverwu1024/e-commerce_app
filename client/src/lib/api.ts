const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export async function api<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const { headers, ...rest } = options;

  const res = await fetch(`${API_URL}${endpoint}`, {
    ...rest,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong');
  }

  return data as T;
}
