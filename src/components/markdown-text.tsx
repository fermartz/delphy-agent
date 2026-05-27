import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const COMPONENTS: Components = {
  h1: ({ children, ...props }) => (
    <h1 className="text-lg font-semibold text-primary mt-2" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="text-base font-semibold text-primary mt-2" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="text-sm font-semibold text-primary mt-2" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4 className="text-sm font-semibold text-primary mt-2" {...props}>
      {children}
    </h4>
  ),
  p: ({ children, ...props }) => (
    <p className="mb-2 last:mb-0" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul className="my-1 ml-5 list-disc" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="my-1 ml-5 list-decimal" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="mb-0.5" {...props}>
      {children}
    </li>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-bold" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic" {...props}>
      {children}
    </em>
  ),
  del: ({ children, ...props }) => (
    <del className="line-through" {...props}>
      {children}
    </del>
  ),
  code: ({ className, children, ...props }) => (
    // Inline-vs-block is decided by CSS, not className. The `[pre_&]:` variants
    // strip inline styling whenever this <code> renders inside a <pre> — covers
    // both labeled fenced blocks (className="language-xxx") AND unlabeled fenced
    // blocks (no className), which would otherwise fall through to inline styling.
    <code
      className={cn(
        "bg-muted px-1 py-0.5 rounded text-xs font-mono",
        "[pre_&]:bg-transparent [pre_&]:p-0 [pre_&]:rounded-none",
        className,
      )}
      {...props}
    >
      {children}
    </code>
  ),
  pre: ({ children, ...props }) => (
    <pre className="bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto my-1" {...props}>
      {children}
    </pre>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="border-l-2 border-muted-foreground/30 pl-3 my-1 text-muted-foreground italic"
      {...props}
    >
      {children}
    </blockquote>
  ),
  hr: (props) => <hr className="border-border my-2" {...props} />,
  a: ({ children, href, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="underline text-primary"
      {...props}
    >
      {children}
    </a>
  ),
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto my-2">
      <table className="border-collapse text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="bg-muted" {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }) => <tbody {...props}>{children}</tbody>,
  tr: ({ children, ...props }) => <tr {...props}>{children}</tr>,
  th: ({ children, ...props }) => (
    <th
      className="sticky top-0 z-10 border border-border bg-muted px-2 py-1 text-left font-semibold"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="border border-border px-2 py-1" {...props}>
      {children}
    </td>
  ),
  input: ({ checked, type, ...props }) => {
    if (type === "checkbox") {
      return (
        <input
          type="checkbox"
          checked={!!checked}
          disabled
          readOnly
          className="mr-2 align-middle"
          {...props}
        />
      );
    }
    return null;
  },
};

interface MarkdownTextProps {
  children: string;
}

export default function MarkdownText({ children }: MarkdownTextProps) {
  return (
    <div>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
