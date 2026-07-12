# Layout Refactor + Workspaces Smoke Checklist

Press F5 → click the restman icon in the Activity Bar (left).

- [ ] The restman sidebar opens as a panel showing: Workspace switcher, Collections (Import/Export), Environments, History.
- [ ] A Default workspace exists and is selected.
- [ ] "New Workspace" creates one; switching the workspace changes which collections are listed.
- [ ] Create a collection in workspace A; switch to workspace B → it is not listed; switch back → it is.
- [ ] Click a request in the sidebar tree → the editor panel opens (or focuses) with that request in a tab.
- [ ] In the editor: set method/url, Send → response shows; the sidebar History updates with the sent request.
- [ ] Click a History entry → opens it in the editor.
- [ ] Save a request into a collection from the editor → it appears in the sidebar tree (same workspace).
- [ ] Environment dropdown in the editor top bar switches the active env; `{{var}}` resolves on Send.
- [ ] Import a Postman collection from the sidebar → it lands in the active workspace.
- [ ] Theme follows VS Code light/dark in both surfaces.
