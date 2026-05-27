import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MarkdownText from "./markdown-text";

describe("MarkdownText", () => {
  it("renders bold (**text**)", () => {
    render(<MarkdownText>{"**hello**"}</MarkdownText>);
    const el = screen.getByText("hello");
    expect(el.tagName).toBe("STRONG");
    expect(el).toHaveClass("font-bold");
  });

  it("renders italic (*text*)", () => {
    render(<MarkdownText>{"*hello*"}</MarkdownText>);
    const el = screen.getByText("hello");
    expect(el.tagName).toBe("EM");
    expect(el).toHaveClass("italic");
  });

  it("renders inline code (`code`) with bg-muted background", () => {
    render(<MarkdownText>{"`mycode`"}</MarkdownText>);
    const el = screen.getByText("mycode");
    expect(el.tagName).toBe("CODE");
    expect(el).toHaveClass("bg-muted");
    expect(el).toHaveClass("font-mono");
  });

  it("renders fenced code block in styled <pre>", () => {
    const { container } = render(<MarkdownText>{"```\nconsole.log('hi')\n```"}</MarkdownText>);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre).toHaveClass("bg-muted");
    expect(pre).toHaveClass("overflow-x-auto");
    expect(pre).toHaveClass("font-mono");
  });

  it("renders h1 with text-lg + text-primary", () => {
    render(<MarkdownText>{"# Heading One"}</MarkdownText>);
    const el = screen.getByText("Heading One");
    expect(el.tagName).toBe("H1");
    expect(el).toHaveClass("text-lg");
    expect(el).toHaveClass("text-primary");
  });

  it("renders h2 with text-base + text-primary", () => {
    render(<MarkdownText>{"## Heading Two"}</MarkdownText>);
    const el = screen.getByText("Heading Two");
    expect(el.tagName).toBe("H2");
    expect(el).toHaveClass("text-base");
    expect(el).toHaveClass("text-primary");
  });

  it("renders h3 with text-sm + text-primary", () => {
    render(<MarkdownText>{"### Heading Three"}</MarkdownText>);
    const el = screen.getByText("Heading Three");
    expect(el.tagName).toBe("H3");
    expect(el).toHaveClass("text-sm");
    expect(el).toHaveClass("text-primary");
  });

  it("renders h4 with text-sm + text-primary", () => {
    render(<MarkdownText>{"#### Heading Four"}</MarkdownText>);
    const el = screen.getByText("Heading Four");
    expect(el.tagName).toBe("H4");
    expect(el).toHaveClass("text-sm");
    expect(el).toHaveClass("text-primary");
  });

  it("renders bulleted list (- item) with list-disc", () => {
    const { container } = render(<MarkdownText>{"- one\n- two"}</MarkdownText>);
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul).toHaveClass("list-disc");
    expect(ul?.children).toHaveLength(2);
  });

  it("renders numbered list (1. item) with list-decimal", () => {
    const { container } = render(<MarkdownText>{"1. one\n2. two"}</MarkdownText>);
    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol).toHaveClass("list-decimal");
    expect(ol?.children).toHaveLength(2);
  });

  it("renders blockquote (> text) with border-l-2 + italic", () => {
    render(<MarkdownText>{"> quoted line"}</MarkdownText>);
    const bq = screen.getByText("quoted line").closest("blockquote");
    expect(bq).not.toBeNull();
    expect(bq).toHaveClass("border-l-2");
    expect(bq).toHaveClass("italic");
  });

  it("renders hr (---) with border-border", () => {
    const { container } = render(<MarkdownText>{"---"}</MarkdownText>);
    const hr = container.querySelector("hr");
    expect(hr).not.toBeNull();
    expect(hr).toHaveClass("border-border");
  });

  it("renders paragraph break (\\n\\n) as separate <p> elements", () => {
    const { container } = render(<MarkdownText>{"para one\n\npara two"}</MarkdownText>);
    const ps = container.querySelectorAll("p");
    expect(ps).toHaveLength(2);
    expect(ps[0]?.textContent).toBe("para one");
    expect(ps[1]?.textContent).toBe("para two");
  });

  it("renders GFM table wrapped in overflow-x-auto + border-collapse", () => {
    const md = "| Col1 | Col2 |\n|------|------|\n| a    | b    |";
    const { container } = render(<MarkdownText>{md}</MarkdownText>);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table).toHaveClass("border-collapse");
    expect(table?.parentElement).toHaveClass("overflow-x-auto");
  });

  it("renders GFM table with sticky thead/th + tbody/tr structure", () => {
    const md = "| Col1 | Col2 |\n|------|------|\n| a    | b    |\n| c    | d    |";
    const { container } = render(<MarkdownText>{md}</MarkdownText>);
    const thead = container.querySelector("thead");
    const tbody = container.querySelector("tbody");
    const rows = container.querySelectorAll("tbody tr");
    const ths = container.querySelectorAll("th");
    const tds = container.querySelectorAll("td");
    expect(thead).not.toBeNull();
    expect(tbody).not.toBeNull();
    expect(rows).toHaveLength(2);
    expect(ths).toHaveLength(2);
    expect(tds).toHaveLength(4);
    // Sticky-header behavior on <th>
    expect(ths[0]).toHaveClass("sticky");
    expect(ths[0]).toHaveClass("top-0");
    expect(ths[0]).toHaveClass("bg-muted");
    // Header + body cells have border styling
    expect(ths[0]).toHaveClass("border");
    expect(ths[0]).toHaveClass("border-border");
    expect(tds[0]).toHaveClass("border");
    expect(tds[0]).toHaveClass("border-border");
  });

  it("renders unlabeled fenced code block without inline styling on inner <code>", () => {
    // No language tag — react-markdown emits <pre><code>...</code></pre> with no className.
    // Inner <code> must NOT apply the inline rounded/padded styling.
    const md = "```\nplain code\n```";
    const { container } = render(<MarkdownText>{md}</MarkdownText>);
    const pre = container.querySelector("pre");
    const code = pre?.querySelector("code");
    expect(pre).not.toBeNull();
    expect(code).not.toBeNull();
    // The <pre> owns the block styling.
    expect(pre).toHaveClass("bg-muted");
    expect(pre).toHaveClass("p-3");
    // The inner <code> carries the override classes so its inline styling is neutralized
    // by the [pre_&]: variants when nested under a <pre>.
    expect(code).toHaveClass("[pre_&]:bg-transparent");
    expect(code).toHaveClass("[pre_&]:p-0");
    expect(code).toHaveClass("[pre_&]:rounded-none");
  });

  it("renders GFM strikethrough (~~text~~) with line-through", () => {
    render(<MarkdownText>{"~~struck~~"}</MarkdownText>);
    const el = screen.getByText("struck");
    expect(el.tagName).toBe("DEL");
    expect(el).toHaveClass("line-through");
  });

  it("renders GFM task list with checkbox (checked + unchecked)", () => {
    const { container } = render(<MarkdownText>{"- [x] done\n- [ ] todo"}</MarkdownText>);
    const inputs = container.querySelectorAll('input[type="checkbox"]');
    expect(inputs).toHaveLength(2);
    expect((inputs[0] as HTMLInputElement).checked).toBe(true);
    expect((inputs[1] as HTMLInputElement).checked).toBe(false);
  });

  it("renders GFM autolink (bare URL) as <a>", () => {
    render(<MarkdownText>{"see https://example.com for more"}</MarkdownText>);
    const link = screen.getByText("https://example.com");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "https://example.com");
  });

  it("renders [text](url) with target=_blank + rel=noreferrer noopener (Parameter 12)", () => {
    render(<MarkdownText>{"[Click](https://example.com)"}</MarkdownText>);
    const link = screen.getByText("Click");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("drops raw HTML via skipHtml", () => {
    const md = 'before <script>alert("x")</script> after';
    const { container } = render(<MarkdownText>{md}</MarkdownText>);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("before");
    expect(container.textContent).toContain("after");
  });

  it("renders streaming half-fence (unclosed ```) without throwing", () => {
    const md = "```python\ndef foo():";
    expect(() => render(<MarkdownText>{md}</MarkdownText>)).not.toThrow();
  });

  it("renders empty input without throwing", () => {
    expect(() => render(<MarkdownText>{""}</MarkdownText>)).not.toThrow();
  });
});
