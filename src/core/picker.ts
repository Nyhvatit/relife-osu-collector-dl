import chalk from "chalk";
import Monitor from "./Monitor";
import { Msg } from "../struct/Message";
import { parseIndexSelection } from "../util";

export function pickFromList(
  monitor: Monitor,
  labels: string[],
  title: string
): number[] | null {
  const selected = new Set<number>();
  let filter = "";
  let page = 0;
  let showSelectedOnly = false;

  for (;;) {
    const rows = process.stdout.rows || 24;
    const pageSize = Math.max(5, rows - 9);

    const filtered = labels
      .map((_, i) => i)
      .filter(
        (i) =>
          (!showSelectedOnly || selected.has(i)) &&
          (!filter || labels[i].toLowerCase().includes(filter))
      );
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.min(Math.max(page, 0), pages - 1);
    const pageItems = filtered.slice(page * pageSize, page * pageSize + pageSize);

    console.clear();

    const cols = Math.min(process.stdout.columns || 60, 60);
    const head = `── ${title} `;
    const tail = `  ${selected.size} selected`;
    const fill = Math.max(0, cols - head.length - tail.length);
    console.log(chalk.cyan(head + "─".repeat(fill)) + chalk.grey(tail));

    let sub = ` page ${page + 1}/${pages} · ${pageItems.length} of ${filtered.length}`;
    if (filter) sub += `   filter: '${filter}'`;
    if (showSelectedOnly) sub += `   [selected only]`;
    console.log(chalk.grey(sub));
    console.log("");

    if (pageItems.length === 0) {
      console.log(chalk.grey("   (no matches)"));
    } else {
      pageItems.forEach((orig, k) => {
        const num = chalk.grey(String(k + 1).padStart(2));
        const on = selected.has(orig);
        const mark = on ? chalk.green("✓") : " ";
        const label = on ? chalk.green(labels[orig]) : labels[orig];
        console.log(`  ${num} ${mark} ${label}`);
      });
    }
    console.log("");

    console.log(chalk`{cyan  Select } {grey numbers e.g. 1,3 · a all/none · v selected-only}`);
    console.log(chalk`{cyan  Move   } {grey n next · p prev · g5 goto · /text find · / clear filter}`);
    console.log(chalk`{cyan  Done   } {grey Enter confirm · c/q cancel}`);

    const input = monitor.awaitInput(Msg.USER_PICK_PROMPT, {}, "");
    const cmd = input.trim().toLowerCase();

    if (cmd === "c") return null;
    if (cmd === "") {
      if (selected.size > 0) return Array.from(selected);
      continue;
    }
    if (cmd === "n") { page++; continue; }
    if (cmd === "p") { page--; continue; }
    if (cmd === "a") {
      const allShown = filtered.length > 0 && filtered.every((i) => selected.has(i));
      if (allShown) filtered.forEach((i) => selected.delete(i));
      else filtered.forEach((i) => selected.add(i));
      continue;
    }
    if (cmd === "v") { showSelectedOnly = !showSelectedOnly; page = 0; continue; }
    if (cmd.startsWith("/")) { filter = cmd.slice(1).trim(); page = 0; continue; }
    if (cmd.startsWith("g")) {
      const target = parseInt(cmd.slice(1));
      if (!isNaN(target)) page = Math.min(Math.max(target - 1, 0), pages - 1);
      continue;
    }

    const idx = parseIndexSelection(input, pageItems.length);
    if (idx) {
      for (const k of idx) {
        const orig = pageItems[k];
        if (selected.has(orig)) selected.delete(orig);
        else selected.add(orig);
      }
    }
  }
}
