if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required in production');
}

export const AUTH_CONFIG = {
  jwtSecret: process.env.JWT_SECRET || 'dev_jwt_secret',
  jwtExpiresIn: '7d',
  bcryptRounds: 10,
  cookie: {
    name: 'token',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
};
