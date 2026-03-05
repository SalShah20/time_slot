export interface TagColor {
  gcalColorId: string;
  hex: string;
  bg: string;
  text: string;
  border: string;
}

export const TAG_COLORS: Record<string, TagColor> = {
  'Study':    { gcalColorId: '9',  hex: '#3B82F6', bg: 'bg-blue-50',   text: 'text-blue-900',   border: 'border-blue-400'   },
  'Work':     { gcalColorId: '11', hex: '#EF4444', bg: 'bg-red-50',    text: 'text-red-900',    border: 'border-red-400'    },
  'Personal': { gcalColorId: '7',  hex: '#028090', bg: 'bg-teal-50',   text: 'text-teal-900',   border: 'border-teal-400'   },
  'Exercise': { gcalColorId: '10', hex: '#10B981', bg: 'bg-green-50',  text: 'text-green-900',  border: 'border-green-400'  },
  'Health':   { gcalColorId: '4',  hex: '#EC4899', bg: 'bg-pink-50',   text: 'text-pink-900',   border: 'border-pink-400'   },
  'Social':   { gcalColorId: '3',  hex: '#8B5CF6', bg: 'bg-purple-50', text: 'text-purple-900', border: 'border-purple-400' },
  'Errands':  { gcalColorId: '6',  hex: '#F97316', bg: 'bg-orange-50', text: 'text-orange-900', border: 'border-orange-400' },
  'Other':    { gcalColorId: '8',  hex: '#6B7280', bg: 'bg-gray-50',   text: 'text-gray-900',   border: 'border-gray-400'   },
};

/** Palette for user-defined custom tags — chosen to be visually distinct from built-ins. */
const CUSTOM_PALETTE: TagColor[] = [
  { gcalColorId: '8', hex: '#6366F1', bg: 'bg-indigo-50',  text: 'text-indigo-900',  border: 'border-indigo-400'  },
  { gcalColorId: '8', hex: '#06B6D4', bg: 'bg-cyan-50',    text: 'text-cyan-900',    border: 'border-cyan-400'    },
  { gcalColorId: '8', hex: '#EAB308', bg: 'bg-yellow-50',  text: 'text-yellow-900',  border: 'border-yellow-400'  },
  { gcalColorId: '8', hex: '#F43F5E', bg: 'bg-rose-50',    text: 'text-rose-900',    border: 'border-rose-400'    },
  { gcalColorId: '8', hex: '#84CC16', bg: 'bg-lime-50',    text: 'text-lime-900',    border: 'border-lime-400'    },
  { gcalColorId: '8', hex: '#7C3AED', bg: 'bg-violet-50',  text: 'text-violet-900',  border: 'border-violet-400'  },
  { gcalColorId: '8', hex: '#0EA5E9', bg: 'bg-sky-50',     text: 'text-sky-900',     border: 'border-sky-400'     },
  { gcalColorId: '8', hex: '#F59E0B', bg: 'bg-amber-50',   text: 'text-amber-900',   border: 'border-amber-400'   },
];

/** Deterministic hash so the same tag name always gets the same color. */
function hashTag(tag: string): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    h = (Math.imul(31, h) + tag.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export const DEFAULT_TAG_COLOR: TagColor = {
  gcalColorId: '7',
  hex: '#028090',
  bg: 'bg-teal-50',
  text: 'text-teal-900',
  border: 'border-teal-400',
};

export function getTagColor(tag: string | null | undefined): TagColor {
  if (!tag) return DEFAULT_TAG_COLOR;
  if (tag in TAG_COLORS) return TAG_COLORS[tag];
  // Custom tag: deterministic color based on tag name
  return CUSTOM_PALETTE[hashTag(tag) % CUSTOM_PALETTE.length];
}
