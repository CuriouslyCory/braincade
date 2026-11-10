import { type WordList, wordListSchema } from '@braincade/learning';
import grade5Starter from '../word-lists/grade-5-starter.json';

/**
 * Word lists ship with the app and the published catalog, so editing a list
 * and deploying updates every device. Register new files here; a test fails if
 * a JSON file in word-lists/ is not listed.
 */
export const wordLists: WordList[] = [grade5Starter].map((list) => wordListSchema.parse(list));
