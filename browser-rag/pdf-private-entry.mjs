import {mountPdfApp} from './pdf-app.mjs';
import {generateFinancialInWorker} from './financial-generation-source.mjs';
import {createFinancialGeometryView} from './financial-geometry-view.mjs';
import {createFinancialLookupView} from './financial-lookup-view.mjs';

mountPdfApp({generate:generateFinancialInWorker,createGeometryView:createFinancialGeometryView,createLookupView:createFinancialLookupView});
