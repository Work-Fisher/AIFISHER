/** Keep file drops in the application; drop targets still receive the event. */
export function preventFileDropNavigation(documentObject: Document = document) {
  const preventNavigation = (event: DragEvent) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  };
  documentObject.addEventListener('dragover', preventNavigation, true);
  documentObject.addEventListener('drop', preventNavigation, true);
  return () => {
    documentObject.removeEventListener('dragover', preventNavigation, true);
    documentObject.removeEventListener('drop', preventNavigation, true);
  };
}
