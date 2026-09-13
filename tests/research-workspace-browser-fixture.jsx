import React from 'react'
import {createRoot} from 'react-dom/client'
import MioResearchWorkspace from '../src/MioResearchWorkspace.jsx'
const rows=[
 {id:'1',title:'Favorable study',authors_text:'A',publication_year:2025,finding_direction:'favors_shared',source_type:'original_empirical',impact_score:88,evidence_strength_score:80,editorial_status:'draft',studies:[{exact_or_near_50_50:true}],access_links:[{access_status:'open'}]},
 {id:'2',title:'Neutral study',authors_text:'B',publication_year:2024,finding_direction:'neutral',source_type:'longitudinal',impact_score:72,evidence_strength_score:75,editorial_status:'needs_review',studies:[],access_links:[]},
 {id:'3',title:'Mixed study',authors_text:'C',publication_year:2023,finding_direction:'mixed',source_type:'systematic_review',impact_score:null,evidence_strength_score:70,editorial_status:'published',studies:[],access_links:[]},
 {id:'4',title:'Conditional study',authors_text:'D',publication_year:2022,finding_direction:'conditional_concern',source_type:'original_empirical',impact_score:61,evidence_strength_score:60,editorial_status:'draft',studies:[],access_links:[]},
 {id:'5',title:'Unfavorable study',authors_text:'E',publication_year:2021,finding_direction:'disfavors_shared',source_type:'natural_experiment',impact_score:77,evidence_strength_score:82,editorial_status:'archived',studies:[],access_links:[]}
]
const supabase={from(){return{select(){return this},order(){return Promise.resolve({data:rows,error:null})}}}}
createRoot(document.getElementById('root')).render(<MioResearchWorkspace session={{user:{id:'u1'}}} supabase={supabase} enabled />)
