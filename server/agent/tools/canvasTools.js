export function searchCanvasNodes({ query, type, nodes, limit = 10 }) {
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
  const normalizedType = String(type || "").trim().toLocaleLowerCase();
  const matches = (Array.isArray(nodes) ? nodes : []).filter((node) => {
    if (normalizedType && String(node?.type || "").toLocaleLowerCase() !== normalizedType) {
      return false;
    }
    if (!normalizedQuery) return true;
    return [node?.id, node?.title, node?.prompt, node?.textContent, node?.model]
      .some((field) => String(field || "").toLocaleLowerCase().includes(normalizedQuery));
  });
  return {
    results: matches.slice(0, limit).map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title || node.type,
      preview: node.textContent || node.prompt || "",
      locateUrl: `locate://${node.id}`,
    })),
    total: matches.length,
  };
}
