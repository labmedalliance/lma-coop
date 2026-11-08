// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Image node of the document schema (browser and server). The image bytes live on the server;
// the node stores the URL /api/docs/<doc>/images/<id>, a description (alt) and the width in percent.
import Image from '@tiptap/extension-image';

const IMAGE_SRC = /^\/api\/docs\/[0-9a-f-]{36}\/images\/[0-9a-f-]{36}$/;
export const IMAGE_WIDTHS = [25, 50, 75, 100];

export const isImageSrc = (src) => IMAGE_SRC.test(String(src ?? ''));

export const ImageNode = Image.extend({
  // Inline like in Google Docs: the image sits in a paragraph, which handles alignment, and
  // suggestions work as for citations.
  atom: true,
  addOptions() {
    return { ...this.parent?.(), inline: true, allowBase64: false };
  },
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      width: {
        default: null,
        parseHTML: (el) => {
          const value = Number.parseInt(el.getAttribute('data-width'), 10);
          return IMAGE_WIDTHS.includes(value) ? value : null;
        },
        renderHTML: ({ width }) => (IMAGE_WIDTHS.includes(width) ? { 'data-width': width, style: `width: ${width}%` } : {}),
      },
    };
  },
  // Only images of this app; external or embedded (data:) images are dropped, as the CSP blocks them anyway.
  parseHTML() {
    return [{ tag: 'img[src]', getAttrs: (el) => (isImageSrc(el.getAttribute('src')) ? null : false) }];
  },
  renderHTML({ HTMLAttributes }) {
    const { src, ...rest } = HTMLAttributes;
    return ['img', { ...rest, src: isImageSrc(src) ? src : '', class: 'doc-image', draggable: 'true' }];
  },
  addInputRules: () => [],
});
