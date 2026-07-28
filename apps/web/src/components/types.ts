export interface Predicate {
  path: string;
  operator: 'equals' | 'exists' | 'in' | 'startsWith';
  value?: string;
}
