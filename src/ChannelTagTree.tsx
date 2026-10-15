import { useEffect, useId, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { ChevronRight, Folder, Layers3, Search, Settings2, Tag, X } from "lucide-react";
import { Button, Input } from "./ui";
import "./channel-tag-tree.css";

export type ChannelTagTreeProps = {
  tags: string[];
  /** Unique channel counts for each full tag or virtual prefix. Parent groups must already be deduplicated. */
  counts: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
  total: number;
  untaggedCount: number;
  selected: string[];
  untaggedOnly: boolean;
  /** A path selects itself and all descendants: tag === path || tag.startsWith(path + "/"). null clears the filter. */
  onSelect: (tag: string | null) => void;
  onUntagged: () => void;
  onManage: () => void;
};

type TagNode = {
  path: string;
  label: string;
  children: TagNode[];
};

function buildTagTree(tags: string[]): TagNode[] {
  const roots: TagNode[] = [];
  const byPath = new Map<string, TagNode>();
  for (const tag of new Set(tags.filter((value) => value.trim()))) {
    // Keep unusual IDs such as "a//b" intact so the callback preserves the original path.
    const pieces = tag.split("/");
    const segments = pieces.every((piece) => piece.trim()) ? pieces : [tag];
    let siblings = roots;
    for (let depth = 0; depth < segments.length; depth++) {
      const path = segments.slice(0, depth + 1).join("/");
      let node = byPath.get(path);
      if (!node) {
        node = { path, label: segments[depth], children: [] };
        siblings.push(node);
        byPath.set(path, node);
      }
      siblings = node.children;
    }
  }
  const sort = (nodes: TagNode[]) => {
    nodes.sort((a, b) => a.label.localeCompare(b.label, "zh-CN", { numeric: true }));
    nodes.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

function filterTagTree(nodes: TagNode[], query: string): TagNode[] {
  if (!query) return nodes;
  return nodes.flatMap((node) => {
    const children = filterTagTree(node.children, query);
    return node.path.toLocaleLowerCase().includes(query) || children.length
      ? [{ ...node, children }]
      : [];
  });
}

function groupCount(counts: ChannelTagTreeProps["counts"], tag: string): number {
  const value = typeof (counts as ReadonlyMap<string, number>).get === "function"
    ? (counts as ReadonlyMap<string, number>).get(tag)
    : (counts as Readonly<Record<string, number>>)[tag];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export default function ChannelTagTree({
  tags,
  counts,
  total,
  untaggedCount,
  selected,
  untaggedOnly,
  onSelect,
  onUntagged,
  onManage,
}: ChannelTagTreeProps) {
  const headingId = useId();
  const groupId = useId();
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildTagTree(tags), [tags]);
  const query = search.trim().toLocaleLowerCase();
  const visible = useMemo(() => filterTagTree(tree, query), [tree, query]);
  const selectedSignature = JSON.stringify(selected);
  const selectedSet = new Set(selected);
  const allSelected = !untaggedOnly && selected.length === 0;

  useEffect(() => {
    // Reveal a newly selected tag even when its ancestors were collapsed before selection.
    setCollapsed((old) => {
      const next = new Set(old);
      for (const tag of selected) {
        const parts = tag.split("/");
        for (let depth = 1; depth < parts.length; depth++) next.delete(parts.slice(0, depth).join("/"));
      }
      return next.size === old.size ? old : next;
    });
  }, [selectedSignature]);

  useEffect(() => {
    if (!query) return;
    setCollapsed((old) => {
      const next = new Set(old);
      const reveal = (nodes: TagNode[]) => nodes.forEach((node) => { next.delete(node.path); reveal(node.children); });
      reveal(visible);
      return next.size === old.size ? old : next;
    });
  }, [query]);

  function toggle(path: string) {
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function renderNodes(nodes: TagNode[], depth = 0) {
    return <ul className="ct-node-list">
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const expanded = !collapsed.has(node.path);
        const active = !untaggedOnly && selectedSet.has(node.path);
        const childId = `${groupId}-${encodeURIComponent(node.path)}`;
        const hasSelectedChild = selected.some((tag) => tag.startsWith(`${node.path}/`));
        return <li key={node.path}>
          <div className={`ct-node-row${active ? " is-selected" : ""}${hasSelectedChild && !expanded ? " has-selection" : ""}`} style={{ "--tag-depth": Math.min(depth, 5) } as CSSProperties}>
            {hasChildren ? <Button
              type="button"
              variant="ghost"
              size="sm"
              isIconOnly
              className="ct-node-expander"
              aria-label={`${expanded ? "收起" : "展开"} ${node.path}`}
              aria-expanded={expanded}
              aria-controls={childId}
              onClick={() => toggle(node.path)}
            ><ChevronRight size={13} style={{ transform: expanded ? "rotate(90deg)" : undefined }} /></Button>
              : <span className="ct-node-marker" aria-hidden="true"><Tag size={12} /></span>}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ct-node-label"
              aria-pressed={active}
              title={`筛选「${node.path}」及其下级标签`}
              onClick={() => onSelect(node.path)}
            >
              <span className="ct-node-name">{node.label}</span>
              <span className="ct-node-count">{groupCount(counts, node.path).toLocaleString("zh-CN")}</span>
            </Button>
          </div>
          {hasChildren && expanded && <div id={childId}>{renderNodes(node.children, depth + 1)}</div>}
        </li>;
      })}
    </ul>;
  }

  return <aside className="ct-tree" aria-labelledby={headingId}>
    <div className="ct-heading">
      <h2 id={headingId}>渠道标签</h2>
      <Button type="button" variant="ghost" size="sm" isIconOnly aria-label="管理渠道标签" title="管理标签" onClick={onManage}><Settings2 size={14} /></Button>
    </div>
    <div className="ct-shortcuts">
      <Button type="button" variant="ghost" className={`ct-shortcut${allSelected ? " is-selected" : ""}`} aria-pressed={allSelected} onClick={() => onSelect(null)}><Layers3 size={14} /><span>全部渠道</span><small>{total.toLocaleString("zh-CN")}</small></Button>
      <Button type="button" variant="ghost" className={`ct-shortcut${untaggedOnly ? " is-selected" : ""}`} aria-pressed={untaggedOnly} onClick={onUntagged}><Folder size={14} /><span>未分组</span><small>{untaggedCount.toLocaleString("zh-CN")}</small></Button>
    </div>
    <div className="ct-search">
      <Search size={13} aria-hidden="true" />
      <Input aria-label="搜索渠道标签" placeholder="搜索标签" value={search} onChange={(event) => setSearch(event.target.value)} />
      {search && <Button type="button" variant="ghost" size="sm" isIconOnly aria-label="清除标签搜索" onClick={() => setSearch("")}><X size={12} /></Button>}
    </div>
    {selected.length > 0 && !untaggedOnly && <div className="ct-current-selection" aria-live="polite"><span title={selected.join("、")}>{selected.length === 1 ? selected[0] : `已选 ${selected.length} 个标签`}</span><Button type="button" variant="ghost" size="sm" isIconOnly aria-label="清除当前标签筛选" onClick={() => onSelect(null)}><X size={11} /></Button></div>}
    <div className="ct-branches" aria-label="标签层级列表">
      {visible.length ? renderNodes(visible) : <div className="ct-empty"><p>{query ? "没有匹配的标签" : "还没有标签"}</p>{query ? <Button type="button" variant="ghost" size="sm" onClick={() => setSearch("")}>清除搜索</Button> : <Button type="button" variant="ghost" size="sm" onClick={onManage}>创建标签</Button>}</div>}
    </div>
  </aside>;
}
