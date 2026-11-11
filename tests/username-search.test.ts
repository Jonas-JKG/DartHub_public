import {it,expect} from 'vitest';
import {normalizeUsername,usernamePattern} from '../src/domain/username';
it('normalises composed and decomposed German usernames without changing their identity',()=>{expect(normalizeUsername('  MÜLLER_ÖÄÜ  ')).toBe('müller_öäü');expect(normalizeUsername('MU\u0308LLER')).toBe('müller');expect(usernamePattern.test(normalizeUsername('GRÖẞE'))).toBe(true);expect(usernamePattern.test('ab')).toBe(false);expect(usernamePattern.test('a%b')).toBe(false);expect(usernamePattern.test('a b')).toBe(false);});
