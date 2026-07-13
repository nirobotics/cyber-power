export interface HierarchyTableNode {
  id: string;
  parentId: string | null;
}

export interface HierarchyTableRow<T extends HierarchyTableNode> {
  item: T;
  visualDepth: number;
  hasChildren: boolean;
}

interface IndexedNode<T extends HierarchyTableNode> {
  item: T;
  sourceIndex: number;
}

export function buildHierarchyTableRows<T extends HierarchyTableNode>(
  items: readonly T[],
  expandedIds: ReadonlySet<string>,
  compareItems: (left: T, right: T) => number,
): HierarchyTableRow<T>[] {
  const indexed = items.map((item, sourceIndex) => ({ item, sourceIndex }));
  const itemsById = new Map(indexed.map((entry) => [entry.item.id, entry]));
  const childrenByParentId = new Map<string, IndexedNode<T>[]>();
  const compareIndexed = (
    left: IndexedNode<T>,
    right: IndexedNode<T>,
  ) => compareItems(left.item, right.item) || left.sourceIndex - right.sourceIndex;

  for (const entry of indexed) {
    const parentId = entry.item.parentId;
    if (parentId === null || !itemsById.has(parentId)) continue;
    const siblings = childrenByParentId.get(parentId) ?? [];
    siblings.push(entry);
    childrenByParentId.set(parentId, siblings);
  }

  for (const siblings of childrenByParentId.values()) siblings.sort(compareIndexed);

  const rows: HierarchyTableRow<T>[] = [];
  const visited = new Set<string>();
  const visit = (entry: IndexedNode<T>, visualDepth: number, visible: boolean) => {
    if (visited.has(entry.item.id)) return;
    visited.add(entry.item.id);
    const children = childrenByParentId.get(entry.item.id) ?? [];
    if (visible) {
      rows.push({
        item: entry.item,
        visualDepth,
        hasChildren: children.length > 0,
      });
    }
    const childrenVisible = visible && expandedIds.has(entry.item.id);
    for (const child of children) visit(child, visualDepth + 1, childrenVisible);
  };

  const roots = indexed
    .filter((entry) => entry.item.parentId === null)
    .sort(compareIndexed);
  for (const root of roots) visit(root, 0, true);

  const orphanRoots = indexed
    .filter(
      (entry) =>
        entry.item.parentId !== null && !itemsById.has(entry.item.parentId),
    )
    .sort(compareIndexed);
  for (const orphanRoot of orphanRoots) visit(orphanRoot, 0, true);

  // Malformed disconnected cycles remain visible instead of disappearing.
  for (const entry of [...indexed].sort(compareIndexed)) visit(entry, 0, true);

  return rows;
}
