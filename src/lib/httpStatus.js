/** What an HTTP status code means, for tooltips. Common codes by name, the rest by class. */
const NAMES = {
  200: 'OK',
  201: 'Created',
  204: 'No content',
  301: 'Moved permanently',
  302: 'Found (redirect)',
  304: 'Not modified',
  400: 'Bad request',
  401: 'Unauthorized: not signed in',
  403: 'Forbidden: signed in but not allowed',
  404: 'Not found',
  405: 'Method not allowed',
  409: 'Conflict: the request clashes with the current state',
  413: 'Payload too large',
  422: 'Unprocessable: failed validation',
  429: 'Too many requests',
  500: 'Internal server error',
  502: 'Bad gateway',
  503: 'Service unavailable',
  504: 'Gateway timeout',
}

const CLASSES = {
  1: 'Informational',
  2: 'Success',
  3: 'Redirect',
  4: 'Client error',
  5: 'Server error',
}

export function httpStatusText(code) {
  const n = Number(code)
  return NAMES[n] ?? CLASSES[Math.floor(n / 100)] ?? 'Unknown status'
}
