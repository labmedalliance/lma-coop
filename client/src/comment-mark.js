// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Anchor of a comment thread in the text: a "comment" mark that carries the thread id.
// The comments themselves live on the server (server/comments.js). Shared by browser and server via schema.js.
import { Mark } from '@tiptap/core';

export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  // Several threads may cover the same text (y-tiptap syncs such overlapping marks separately).
  excludes: '',
  addAttributes: () => ({
    threadId: {
      default: null,
      parseHTML: (el) => el.getAttribute('data-comment'),
      renderHTML: (attrs) => ({ 'data-comment': attrs.threadId }),
    },
  }),
  parseHTML: () => [{ tag: 'span[data-comment]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
});

/** Adds a step to `tr` that removes all comment anchors (used before comparing documents). */
export function stripCommentMarks(doc, tr) {
  const type = doc.type.schema.marks.comment;
  if (type) tr.removeMark(0, doc.content.size, type);
  return tr;
}

/** Map(threadId -> { from, to }) of all anchors in document order. */
export function commentRanges(doc) {
  const ranges = new Map();
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    for (const mark of node.marks) {
      if (mark.type.name !== 'comment' || !mark.attrs.threadId) continue;
      const range = ranges.get(mark.attrs.threadId);
      if (range) range.to = pos + node.nodeSize;
      else ranges.set(mark.attrs.threadId, { from: pos, to: pos + node.nodeSize });
    }
    return false;
  });
  return ranges;
}
