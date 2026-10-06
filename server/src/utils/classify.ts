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
    return { code: 'NO_FORMAT', http: 422, hint: 'No downloadable format is available for that video.' };
  }
  return { code: 'ENGINE_ERROR', http: 500, hint: 'The download engine hit an unexpected error.' };
}
