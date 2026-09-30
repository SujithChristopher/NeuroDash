import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
	it('joins rows with CRLF and quotes special characters', () => {
		expect(toCsv(['a', 'b'], [[1, 'x,y'], [2, 'say "hi"']])).toBe('a,b\r\n1,"x,y"\r\n2,"say ""hi"""');
	});
	it('renders null/undefined as empty', () => {
		expect(toCsv(['a'], [[null], [undefined]])).toBe('a\r\n\r\n');
	});
	it('defuses formula injection but keeps plain negative numbers', () => {
		expect(toCsv(['a'], [['=SUM(A1)'], [-5], ['+1 call']])).toBe("a\r\n'=SUM(A1)\r\n-5\r\n'+1 call");
	});
});
