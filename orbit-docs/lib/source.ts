import { docs } from '@/.source';
import { loader } from 'fumadocs-core/source';

const fumadocsSource = docs.toFumadocsSource();

// fumadocs-mdx v11 returns files as a getter function,
// but fumadocs-core v15 expects an array — unwrap it
const resolvedSource = {
  ...fumadocsSource,
  files: typeof fumadocsSource.files === 'function'
    ? (fumadocsSource.files as unknown as () => any[])()
    : fumadocsSource.files,
};

export const source = loader({
  baseUrl: '/docs',
  source: resolvedSource,
});
