/** Public handles are case-insensitive and use NFC; transliteration is search-only. */
export const normalizeUsername=(value:string)=>value.trim().normalize('NFC').toLowerCase();
export const usernamePattern=/^[a-zäöüß0-9_]{3,24}$/;
export const usernameInputPattern='[A-Za-zÄÖÜẞäöüß0-9_]{3,24}';
