package uz.rhythm.money;

import android.app.job.JobService;
import android.app.job.JobParameters;

public final class SyncJob extends JobService {
    private Thread worker;
    @Override public boolean onStartJob(JobParameters parameters) {
        worker = new Thread(() -> { try { boolean more = SyncEngine.sync(this); if (!Thread.currentThread().isInterrupted()) { jobFinished(parameters, false); if (more) SyncJobs.queue(this); } } catch (Exception error) { if (!Thread.currentThread().isInterrupted()) jobFinished(parameters, true); } }, "rhythm-sync"); worker.start(); return true;
    }
    @Override public boolean onStopJob(JobParameters parameters) { if (worker != null) worker.interrupt(); return true; }
}
