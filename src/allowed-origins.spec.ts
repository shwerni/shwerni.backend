// utils
import { allowedOrigins, corsOrigin, corsOrigins } from './allowed-origins';

describe('allowed origins', () => {
  const saved = {
    ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN,
    NODE_ENV: process.env.NODE_ENV,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('splits, trims and drops trailing slashes', () => {
    process.env.ALLOWED_ORIGIN =
      ' https://shwerni.sa/ , https://www.shwerni.sa//,,';
    expect(allowedOrigins()).toEqual([
      'https://shwerni.sa',
      'https://www.shwerni.sa',
    ]);
  });

  it('an empty or unset value adds nothing', () => {
    process.env.ALLOWED_ORIGIN = '';
    expect(allowedOrigins()).toEqual([]);
    delete process.env.ALLOWED_ORIGIN;
    expect(allowedOrigins()).toEqual([]);
  });

  it('localhost:3000 only outside production', () => {
    process.env.ALLOWED_ORIGIN = 'https://shwerni.sa';

    process.env.NODE_ENV = 'production';
    expect(corsOrigins()).toEqual([
      'https://shwerni.sa',
      'shwerni://',
      'exp://',
    ]);

    process.env.NODE_ENV = 'development';
    expect(corsOrigins()).toContain('http://localhost:3000');
  });

  it('the cors callback reads the env when called, not when imported', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOWED_ORIGIN = 'https://later.example';

    const callback = jest.fn();
    corsOrigin('https://later.example', callback);

    expect(callback).toHaveBeenCalledWith(null, [
      'https://later.example',
      'shwerni://',
      'exp://',
    ]);
  });
});
