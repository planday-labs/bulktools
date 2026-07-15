import { WorkflowAppWithLayout } from './components/WorkflowAppWithLayout';
import { usePlandayApi } from './hooks/usePlandayApi';
import { ValidationService } from './services/mappingService';
import { useEffect } from 'react';

function App() {
  const plandayApi = usePlandayApi();

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      // @ts-expect-error - Intentionally adding to window for debugging
      window.debugPlanday = {
        diagnoseFieldInconsistencies: () => ValidationService.diagnoseFieldInconsistencies(),
        getPlandayApi: () => plandayApi,
        getFieldDefinitions: () => plandayApi.fieldDefinitions,
        getRequiredFields: () => ValidationService.getRequiredFields(),
        getCustomFields: () => ValidationService.getCustomFields(),
      };
    }

    return () => {
      // @ts-expect-error - cleanup
      if (typeof window !== 'undefined' && window.debugPlanday) {
        // @ts-expect-error - cleanup
        delete window.debugPlanday;
      }
    };
  }, [plandayApi]);

  return <WorkflowAppWithLayout />;
}

export default App;
