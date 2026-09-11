export function nextBranchName(branches, rootId) {
  const names = new Set(Object.values(branches).filter(b => b.rootId === rootId).flatMap(b => [b.name, b.numberLabel]));
  let number = 1;
  while (names.has(`分支 ${number}`)) number++;
  return `分支 ${number}`;
}
