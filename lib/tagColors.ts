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

export const DEFAULT_TAG_COLOR: TagColor = {
  gcalColorId: '7',
  hex: '#028090',
  bg: 'bg-teal-50',
  text: 'text-teal-900',
  border: 'border-teal-400',
};

export function getTagColor(tag: string | null | undefined): TagColor {
  if (!tag) return DEFAULT_TAG_COLOR;
  return TAG_COLORS[tag] ?? DEFAULT_TAG_COLOR;
}
