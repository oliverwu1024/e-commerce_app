const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export async function api<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const { headers, ...rest } = options;

  const defaultHeaders: Record<string, string> = {};
  if (rest.body && typeof rest.body === 'string') {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_URL}${endpoint}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...defaultHeaders,
      ...headers,
    },
  });

  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: `Server error (${res.status})` };
  }

  if (!res.ok) {
    throw new Error((data.error as string) || 'Something went wrong');
  }

  return data as T;
}
