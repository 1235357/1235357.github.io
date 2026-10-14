# Keep documentation navigation outside the live workspace

The profile embeds a light PDF workspace. Following the workspace's engineering
notes or chunking lesson used to navigate that same iframe to a dark journal
article, replacing the PDF session. The public build also injected three model
notice links that replaced the workspace with plain text.

All five documentation links now open a separate tab, with `noopener noreferrer`
and an accessible label that announces the new tab. Workspace and Notebook
fragments continue to navigate the existing document. Profile remains an explicit
top-level exit. No model, retrieval, financial, or generation behavior changes.

Regression checks parse the source navigation and the actual generated public
notice links. In the Codex in-app browser, a two-page controlled PDF was parsed
and chunked before following the article links; both source pages and the two
chunks remained in the light workspace afterward. A fresh public check is
recorded separately from local browser observations.

Local validation: 3,098 Node checks and 165 Python checks passed; the explicit
public build passed. These checks do not establish subjective design approval or
financial-answer quality.
