/** Map engine stderr into stable error codes + HTTP status + human hint (§9.4). */

export interface Classified {
  code: string;
  http: number;
  hint: string;
}

export function classifyResolveError(text: string): Classified {
  const s = (text || '').toLowerCase();

  if (/timed?\s?out|deadline|operation too slow/.test(s)) {
    return { code: 'TIMEOUT', http: 504, hint: 'The engine took too long to respond. Try again in a moment.' };
  }
  if (/maxbuffer|buffer.*out.*of.*bounds|too large|enobufs/.test(s)) {
    return { code: 'METADATA_TOO_LARGE', http: 504, hint: 'The video metadata is too large to process.' };
  }
  if (/ssl|tls|certificate|connection (reset|aborted|closed|refused)|could not connect|unable to connect|network is unreachable|name or service not known|nodename|temporary failure in name resolution|eof/.test(s)) {
    return { code: 'NETWORK', http: 502, hint: 'The server could not reach the video platform (connection/SSL failure). This can be transient — try again. If it persists, check this server\u2019s outbound internet access.' };
  }
  if (/private|members only|login required|sign in|log in|age[- ]?restrict|mature/.test(s)) {
    return { code: 'RESTRICTED', http: 422, hint: 'This video is private, age-restricted or requires a login, so it cannot be downloaded.' };
  }
  if (/not available|unavailable|removed|deleted|does not exist|no video/.test(s)) {
    return { code: 'UNAVAILABLE', http: 422, hint: 'That video is unavailable — it may have been removed or made private.' };
  }
  if (/geo|blocked in your country|403|forbidden|access denied/.test(s)) {
    return { code: 'RESTRICTED', http: 422, hint: 'This video is blocked in the server region or requires access we do not have.' };
  }
  if (/not a valid url|unsupported url|unsupported protocol/.test(s)) {
    return { code: 'UNSUPPORTED', http: 422, hint: 'The engine does not recognise that URL.' };
  }
  if (/no formats|format.*not available|requested format/.test(s)) {
    return { code: 'NO_FORMAT', http: 422, hint: 'That video has no single-file MP4 (common for live streams). Try MP3, or use a regular non-live video.' };
  }
  return { code: 'ENGINE_ERROR', http: 500, hint: 'The download engine hit an unexpected error.' };
}
