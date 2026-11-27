/**
 * Planted for `../no-sql.test.ts`: each export below holds one SQL word
 * the guard must report. The words in comments, here SELECT, INSERT,
 * CREATE and WHERE, are the control it must pass over.
 */

// A line comment naming SELECT is passed over.
export const plantedSelect: string = 'SELECT store_id FROM store_meta';

/* A block comment naming INSERT is passed over. */
export const plantedInsert: string = `INSERT INTO ${'commits'} VALUES (?)`;

export const plantedCreate: string = `${'x'} CREATE TABLE t (id INTEGER)`; // a trailing WHERE is passed over

/** A string holding a comment opener hides nothing after it. */
export const plantedWhere: string = 'https://example.invalid/* ' + 'DELETE FROM commits WHERE seq = 1';

/** Lower case and longer words are not the guarded words. */
export const clean: readonly string[] = ['select', 'created', 'elsewhere', 'SELECTED'];
