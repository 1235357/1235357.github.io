import {mountPdfApp} from './pdf-app.mjs';
import {installNotebookNavigation} from './notebook-navigation.mjs';

installNotebookNavigation(document, window);
mountPdfApp();
