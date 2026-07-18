"use client";

import { useState, useEffect } from "react";
import { X, Tag, Landmark, Clock3, ShieldCheck, Download, ExternalLink, CalendarDays, MapPin, Banknote, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Card, Skeleton, LinkButton } from "@/components/ui";

interface TenderListProps {
  tenders: any[];
  fullAccess: boolean;
}

export function TenderListInteractive({ tenders, fullAccess }: TenderListProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<any | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    
    setLoading(true);
    setDrawerOpen(true);
    
    fetch(`/api/tenders/${selectedId}`)
      .then(res => res.json())
      .then(res => {
        if (res.success && res.data) {
          setDetails(res.data);
        } else {
          setDetails(null);
        }
        setLoading(false);
      })
      .catch(() => {
        setDetails(null);
        setLoading(false);
      });
  }, [selectedId]);

  const closeDrawer = () => {
    setDrawerOpen(false);
    // Add brief delay before clearing selection to avoid quick layout jump during slide out animation
    setTimeout(() => {
      setSelectedId(null);
      setDetails(null);
    }, 300);
  };

  return (
    <>
      <div className="space-y-4">
        {tenders.map((tender) => {
          const isActive = tender.active_status === "Active" || tender.status === "published";
          const score = typeof tender.recommendation_score === "number" ? tender.recommendation_score : null;
          
          return (
            <div
              key={tender.id}
              onClick={() => setSelectedId(tender.id)}
              className="card lift cursor-pointer relative overflow-hidden bg-white/70 backdrop-blur-md border border-slate-200/80 hover:bg-slate-50/50 hover:border-slate-300 transition duration-200"
            >
              {/* Top accent strip based on status */}
              <div className={cn(
                "absolute top-0 left-0 w-1.5 h-full",
                isActive ? "bg-success" : "bg-warning"
              )} />
              
              <div className="pl-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="mb-2 flex flex-wrap gap-2">
                      <Badge tone={isActive ? "good" : "warn"}>
                        {isActive ? "Active" : "Expired / Non-Active"}
                      </Badge>
                      {tender.procurement_category || tender.category ? (
                        <Badge tone="muted">{tender.procurement_category ?? tender.category}</Badge>
                      ) : null}
                      {tender.sector ? (
                        <Badge tone="muted">{String(tender.sector).replaceAll("_", " ")}</Badge>
                      ) : null}
                    </div>
                    
                    <h3 className="font-display text-lg font-bold text-slate-900 tracking-tight mb-1 hover:text-primary transition duration-150">
                      {tender.title ?? "Untitled tender"}
                    </h3>
                    
                    <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-1.5">
                      <span>{tender.department ?? "Department needs review"}</span>
                      <span className="text-slate-300">•</span>
                      <span>{tender.city ?? tender.province ?? "Pakistan"}</span>
                    </p>
                  </div>
                  
                  <div className="flex flex-col items-end shrink-0 text-right">
                    {score !== null ? (
                      <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1 mb-2">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">RECON Score</span>
                        <span className="text-sm font-black text-slate-800">{score}</span>
                      </div>
                    ) : null}
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Closing date</p>
                    <p className="text-sm font-semibold text-slate-800">
                      {tender.closing_date ? new Date(tender.closing_date).toLocaleDateString("en-PK", { dateStyle: "medium" }) : "Needs review"}
                    </p>
                  </div>
                </div>
                
                {tender.preview ? (
                  <p className="mt-3 text-sm text-slate-600 line-clamp-2 leading-relaxed">
                    {tender.preview}
                  </p>
                ) : null}
                
                {fullAccess && (tender.estimated_cost || tender.estimated_value) ? (
                  <div className="mt-4 pt-3 border-t border-slate-100 grid gap-3 text-xs md:grid-cols-3 text-slate-500 font-semibold">
                    <div>
                      Estimated Cost: <span className="text-slate-800 font-bold">{tender.estimated_cost ?? (tender.estimated_value ? `Rs. ${Number(tender.estimated_value).toLocaleString("en-PK")}` : "Cost Not Available")}</span>
                    </div>
                    <div>
                      Tender Type: <span className="text-slate-800 font-bold">{tender.tender_type ?? tender.procurement_category ?? "Needs review"}</span>
                    </div>
                    <div>
                      Tender Number: <span className="text-slate-800 font-bold">{tender.tender_number ?? "Needs review"}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Slide-out Drawer Overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* Backdrop */}
          <div 
            onClick={closeDrawer}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-300"
          />

          {/* Slider Panel */}
          <div className="absolute inset-y-0 right-0 max-w-full pl-10 flex">
            <div className={cn(
              "w-screen max-w-2xl bg-[#FAF9F5] border-l border-slate-200/80 shadow-2xl flex flex-col transform transition-transform duration-300 ease-out translate-x-0"
            )}>
              {/* Header */}
              <div className="bg-[#FAF9F5] border-b border-slate-200/60 px-6 py-5 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Tender Detail Preview</span>
                <button 
                  onClick={closeDrawer}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-200/60 hover:text-slate-900 transition duration-150"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Scrollable Container */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {loading ? (
                  /* Loading Skeletons with Dotted Shadows */
                  <div className="space-y-6 animate-pulse">
                    <div className="p-6 bg-white border border-slate-200/60 rounded-xl space-y-4 shadow-sm">
                      <div className="h-4 bg-slate-200 rounded w-1/4" />
                      <div className="h-7 bg-slate-200 rounded w-3/4" />
                      <div className="h-5 bg-slate-200 rounded w-1/2" />
                    </div>
                    
                    <div className="p-6 bg-white border border-slate-200/60 rounded-xl space-y-4 shadow-sm">
                      <div className="h-5 bg-slate-200 rounded w-1/3" />
                      <div className="grid grid-cols-2 gap-4">
                        <div className="h-10 bg-slate-200 rounded" />
                        <div className="h-10 bg-slate-200 rounded" />
                        <div className="h-10 bg-slate-200 rounded" />
                        <div className="h-10 bg-slate-200 rounded" />
                      </div>
                    </div>
                  </div>
                ) : details ? (
                  /* Customized Layout Details View */
                  <div className="space-y-6 animate-in">
                    
                    {/* Primary Highlight Header Card */}
                    <div className="card-dark p-6 relative overflow-hidden shadow-md">
                      <div className="absolute -right-16 -top-16 size-48 rounded-full bg-white/5 blur-2xl" />
                      <div className="relative space-y-3">
                        <div className="flex items-center gap-2">
                          <Badge tone="good">{details.active_status ?? "Active"}</Badge>
                          {details.procurement_category && <Badge tone="muted">{details.procurement_category}</Badge>}
                        </div>
                        <h2 className="font-display text-2xl font-black text-white leading-snug tracking-tight">
                          {details.title}
                        </h2>
                        
                        <div className="pt-3 border-t border-white/10 grid gap-3 sm:grid-cols-2 text-sm text-slate-300">
                          <div className="flex items-center gap-2">
                            <Tag className="h-4 w-4 text-emerald-400 shrink-0" />
                            <span>Tender No: <strong className="text-white">{details.tender_number ?? "Needs review"}</strong></span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Landmark className="h-4 w-4 text-emerald-400 shrink-0" />
                            <span className="truncate">Org: <strong className="text-white">{details.department ?? "Needs review"}</strong></span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Overview & Core Facts Bento */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="card p-4 space-y-2 bg-white/80 border border-slate-200/60 shadow-xs">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                          <MapPin className="h-3.5 w-3.5 text-primary" />
                          Location details
                        </div>
                        <p className="text-sm font-semibold text-slate-800">
                          {details.city ? `${details.city}, ${details.province}` : details.province ?? "Pakistan"}
                        </p>
                      </div>

                      <div className="card p-4 space-y-2 bg-white/80 border border-slate-200/60 shadow-xs">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                          <Clock3 className="h-3.5 w-3.5 text-primary" />
                          Closing date
                        </div>
                        <p className="text-sm font-semibold text-slate-800">
                          {details.closing_date ? new Date(details.closing_date).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" }) : "Needs review"}
                        </p>
                      </div>
                    </div>

                    {/* Financial Specs */}
                    <div className="card p-5 bg-white/80 border border-slate-200/60 shadow-xs space-y-4">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Commercial Specifications</h4>
                      <div className="grid gap-4 sm:grid-cols-3 text-sm">
                        <div>
                          <dt className="text-muted-foreground">Estimated cost</dt>
                          <dd className="font-semibold text-slate-800 mt-0.5">{details.estimated_cost ?? "Cost Not Available"}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Bid Security</dt>
                          <dd className="font-semibold text-slate-800 mt-0.5">
                            {details.bid_security_amount ? `Rs. ${Number(details.bid_security_amount).toLocaleString("en-PK")}` : "Needs verification"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Document Fee</dt>
                          <dd className="font-semibold text-slate-800 mt-0.5">
                            {details.document_fee ? `Rs. ${Number(details.document_fee).toLocaleString("en-PK")}` : "Free"}
                          </dd>
                        </div>
                      </div>
                    </div>

                    {/* Requirements details */}
                    <div className="card p-5 bg-white/80 border border-slate-200/60 shadow-xs space-y-4">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Compliance Checklist</h4>
                      <div className="grid gap-3 text-sm">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                          <span className="text-muted-foreground">PEC Requirements</span>
                          <span className="font-bold text-slate-800">{details.pec_category ?? "Not stated"}</span>
                        </div>
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                          <span className="text-muted-foreground">Procurement Method</span>
                          <span className="font-bold text-slate-800">{details.procurement_method ?? "Needs review"}</span>
                        </div>
                        <div className="flex items-center justify-between pb-1">
                          <span className="text-muted-foreground">Submission Method</span>
                          <span className="font-bold text-slate-800">{details.submission_method ?? "Needs review"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action Panel */}
                    <div className="p-4 bg-slate-100/50 border border-slate-200/60 rounded-xl flex flex-wrap gap-3 items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Official Tender Notice</p>
                        <p className="text-xs text-muted-foreground">scanned index files are stored privately.</p>
                      </div>
                      
                      <div className="flex gap-2">
                        {details.original_source_url && (
                          <a 
                            href={details.original_source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition"
                          >
                            <ExternalLink className="h-3.5 w-3.5" /> Source
                          </a>
                        )}
                        <LinkButton 
                          href={fullAccess ? `/tenders/${details.id}` : "/pricing"}
                          className="h-9 px-4 text-xs"
                        >
                          {fullAccess ? "View Full Workspace" : "Unlock with Paid Plan"}
                        </LinkButton>
                      </div>
                    </div>

                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-sm text-muted-foreground">Tender record details could not be loaded.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
